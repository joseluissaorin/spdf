using System.Text;

namespace Spdf.Tests;

public class CryptoAndVectorTests
{
    [Fact]
    public void Ed25519MatchesRfc8032Test1()
    {
        var sk = Convert.FromHexString("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
        var pk = Ed25519.PublicKey(sk);
        Assert.Equal("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", Convert.ToHexString(pk).ToLowerInvariant());
        var sig = Ed25519.Sign(sk, []);
        Assert.Equal("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
            Convert.ToHexString(sig).ToLowerInvariant());
        Assert.True(Ed25519.Verify(pk, [], sig));
        Assert.False(Ed25519.Verify(pk, "x"u8.ToArray(), sig));
    }

    [Fact]
    public void SignatureOfTheSpecVerifies()
    {
        var sk = new byte[32];
        sk[0] = 7;
        string hash = new('a', 64);
        var sig = Ed25519.Sign(sk, Encoding.ASCII.GetBytes("spdf-content-sha256:" + hash));
        string signer = "ed25519:" + Convert.ToBase64String(Ed25519.PublicKey(sk));
        Assert.True(SpdfValidator.VerifySignature(hash, Convert.ToBase64String(sig), signer));
        Assert.False(SpdfValidator.VerifySignature(new string('b', 64), Convert.ToBase64String(sig), signer));
        Assert.False(SpdfValidator.VerifySignature(hash, " " + Convert.ToBase64String(sig), signer));
    }

    [Fact]
    public void QuantizesLikeTheSpecification()
    {
        Assert.Equal("007f8140c0205f", Hex(VectorCodec.Quantize([0, 1, -1, 0.5, -0.5, 0.25, 0.75], "i8")));
        Assert.Equal("7f810df3", Hex(VectorCodec.Quantize([1.5, -2, 0.1, -0.1], "i8")));
        Assert.Equal("662eff7b00005535", Hex(VectorCodec.Quantize([0.1, 65504, 0, 0.333333], "f16")));
        Assert.Equal("cdcccc3d9faaaa3e", Hex(VectorCodec.Quantize([0.1, 0.333333], "f32")));
        Assert.Throws<ArgumentException>(() => VectorCodec.Quantize([65520.0], "f16"));
        Assert.Throws<ArgumentException>(() => VectorCodec.Quantize([1e39], "f32"));
        Assert.Throws<ArgumentException>(() => VectorCodec.Quantize([1.0], "f64"));
    }

    [Fact]
    public void DecodesEveryDtype()
    {
        Assert.Equal([0.5, -0.25], VectorCodec.Decode(VectorCodec.Quantize([0.5, -0.25], "f32"), "f32"));
        Assert.Equal([0.5, -0.25], VectorCodec.Decode(VectorCodec.Quantize([0.5, -0.25], "f16"), "f16"));
        Assert.Equal([127 / 127.0, -64 / 127.0], VectorCodec.Decode([127, unchecked((byte)-64)], "i8"));
    }

    private static string Hex(byte[] b) => Convert.ToHexString(b).ToLowerInvariant();
}
