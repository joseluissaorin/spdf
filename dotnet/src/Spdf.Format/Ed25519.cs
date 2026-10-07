using System.Numerics;
using System.Security.Cryptography;

namespace Spdf;

/// <summary>
/// Ed25519 (RFC 8032, §5.1, pure) over <see cref="BigInteger"/>, ported from the reference of
/// the conformance suite (<c>conformance/tools/ed25519.py</c>); .NET 8 has no built-in
/// Ed25519. Signatures are deterministic, as RFC 8032 requires.
/// </summary>
/// <remarks>
/// <b>Not constant-time.</b> <see cref="Sign"/> and <see cref="PublicKey"/> handle the secret
/// key with variable-time big-integer arithmetic, which can leak it through timing to anyone
/// able to measure many signatures on the same machine. Sign only on a trusted machine, never
/// in a shared or multi-tenant service. <see cref="Verify"/> handles public data only and is
/// safe anywhere.
/// </remarks>
public static class Ed25519
{
    private static readonly BigInteger P = BigInteger.Pow(2, 255) - 19;
    private static readonly BigInteger L = BigInteger.Pow(2, 252) + BigInteger.Parse("27742317777372353535851937790883648493", System.Globalization.CultureInfo.InvariantCulture);
    private static readonly BigInteger D = Mod(-121665 * Inv(121666));
    private static readonly BigInteger SqrtM1 = BigInteger.ModPow(2, (P - 1) / 4, P);
    private static readonly Point G = MakeBase();

    private readonly record struct Point(BigInteger X, BigInteger Y, BigInteger Z, BigInteger T);

    private static BigInteger Mod(BigInteger x)
    {
        var r = BigInteger.Remainder(x, P);
        return r.Sign < 0 ? r + P : r;
    }

    private static BigInteger Inv(BigInteger x) => BigInteger.ModPow(Mod(x), P - 2, P);

    private static BigInteger FromLittleEndian(ReadOnlySpan<byte> b) => new(b, isUnsigned: true, isBigEndian: false);

    private static byte[] ToLittleEndian32(BigInteger v)
    {
        var out_ = new byte[32];
        var raw = v.ToByteArray(isUnsigned: true, isBigEndian: false);
        Array.Copy(raw, out_, Math.Min(raw.Length, 32));
        return out_;
    }

    private static BigInteger Sha512ModL(params byte[][] parts)
    {
        using var h = IncrementalHash.CreateHash(HashAlgorithmName.SHA512);
        foreach (var p in parts)
        {
            h.AppendData(p);
        }
        return BigInteger.Remainder(FromLittleEndian(h.GetHashAndReset()), L);
    }

    private static Point Add(Point p, Point q)
    {
        var a = Mod((p.Y - p.X) * (q.Y - q.X));
        var b = Mod((p.Y + p.X) * (q.Y + q.X));
        var c = Mod(2 * p.T * q.T * D);
        var d = Mod(2 * p.Z * q.Z);
        BigInteger e = b - a, f = d - c, g = d + c, h = b + a;
        return new Point(Mod(e * f), Mod(g * h), Mod(f * g), Mod(e * h));
    }

    private static Point Multiply(BigInteger s, Point p)
    {
        var q = new Point(0, 1, 1, 0);
        while (s.Sign > 0)
        {
            if (!s.IsEven)
            {
                q = Add(q, p);
            }
            p = Add(p, p);
            s >>= 1;
        }
        return q;
    }

    private static bool Equal(Point p, Point q) =>
        Mod(p.X * q.Z - q.X * p.Z).IsZero && Mod(p.Y * q.Z - q.Y * p.Z).IsZero;

    private static BigInteger? RecoverX(BigInteger y, int sign)
    {
        if (y >= P)
        {
            return null;
        }
        var x2 = Mod((y * y - 1) * Inv(D * y * y + 1));
        if (x2.IsZero)
        {
            return sign != 0 ? null : BigInteger.Zero;
        }
        var x = BigInteger.ModPow(x2, (P + 3) / 8, P);
        if (!Mod(x * x - x2).IsZero)
        {
            x = Mod(x * SqrtM1);
        }
        if (!Mod(x * x - x2).IsZero)
        {
            return null;
        }
        if ((int)(x & 1) != sign)
        {
            x = P - x;
        }
        return x;
    }

    private static Point MakeBase()
    {
        var gy = Mod(4 * Inv(5));
        var gx = RecoverX(gy, 0)!.Value;
        return new Point(gx, gy, 1, Mod(gx * gy));
    }

    private static byte[] Compress(Point p)
    {
        var zinv = Inv(p.Z);
        var x = Mod(p.X * zinv);
        var y = Mod(p.Y * zinv);
        return ToLittleEndian32(y | ((x & 1) << 255));
    }

    private static Point? Decompress(ReadOnlySpan<byte> s)
    {
        if (s.Length != 32)
        {
            return null;
        }
        var y = FromLittleEndian(s);
        int sign = (int)(y >> 255);
        y &= (BigInteger.One << 255) - 1;
        var x = RecoverX(y, sign);
        if (x is null)
        {
            return null;
        }
        return new Point(x.Value, y, 1, Mod(x.Value * y));
    }

    private static (BigInteger A, byte[] Prefix) Expand(byte[] secret)
    {
        if (secret.Length != 32)
        {
            throw new ArgumentException("Ed25519 secret keys are 32 bytes");
        }
        var h = SHA512.HashData(secret);
        var a = FromLittleEndian(h.AsSpan(0, 32));
        a &= (BigInteger.One << 254) - 8;
        a |= BigInteger.One << 254;
        return (a, h[32..]);
    }

    /// <summary>The 32-byte public key of a 32-byte secret key (seed). Not constant-time: see the remarks of <see cref="Ed25519"/>.</summary>
    /// <exception cref="ArgumentException">The secret key is not 32 bytes.</exception>
    public static byte[] PublicKey(byte[] secret)
    {
        ArgumentNullException.ThrowIfNull(secret);
        return Compress(Multiply(Expand(secret).A, G));
    }

    /// <summary>The deterministic 64-byte signature of a message (RFC 8032). Not constant-time: sign on a trusted machine (see the remarks of <see cref="Ed25519"/>).</summary>
    /// <exception cref="ArgumentException">The secret key is not 32 bytes.</exception>
    public static byte[] Sign(byte[] secret, byte[] message)
    {
        ArgumentNullException.ThrowIfNull(secret);
        ArgumentNullException.ThrowIfNull(message);
        var (a, prefix) = Expand(secret);
        var pub = Compress(Multiply(a, G));
        var r = Sha512ModL(prefix, message);
        var rEnc = Compress(Multiply(r, G));
        var h = Sha512ModL(rEnc, pub, message);
        var s = BigInteger.Remainder(r + h * a, L);
        return [.. rEnc, .. ToLittleEndian32(s)];
    }

    /// <summary>Verifies a 64-byte signature of a message with a 32-byte public key.</summary>
    public static bool Verify(byte[] publicKey, byte[] message, byte[] signature)
    {
        ArgumentNullException.ThrowIfNull(publicKey);
        ArgumentNullException.ThrowIfNull(message);
        ArgumentNullException.ThrowIfNull(signature);
        if (publicKey.Length != 32 || signature.Length != 64)
        {
            return false;
        }
        var a = Decompress(publicKey);
        if (a is null)
        {
            return false;
        }
        var r = Decompress(signature.AsSpan(0, 32));
        if (r is null)
        {
            return false;
        }
        var s = FromLittleEndian(signature.AsSpan(32, 32));
        if (s >= L)
        {
            return false;
        }
        var h = Sha512ModL(signature[..32], publicKey, message);
        return Equal(Multiply(s, G), Add(r.Value, Multiply(h, a.Value)));
    }
}
