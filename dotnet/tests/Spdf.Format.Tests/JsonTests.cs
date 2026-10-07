namespace Spdf.Tests;

public class JsonTests
{
    [Fact]
    public void ParsesIntegersAsLongAndTheRestAsDouble()
    {
        var v = (List<object?>)SpdfJson.Parse("[1, -2, 1.0, 1e2, 12345678901234567890, true, null, \"x\"]")!;
        Assert.IsType<long>(v[0]);
        Assert.Equal(-2L, v[1]);
        Assert.IsType<double>(v[2]);
        Assert.IsType<double>(v[3]);
        Assert.IsType<double>(v[4]);
        Assert.Equal(true, v[5]);
        Assert.Null(v[6]);
        Assert.Equal("x", v[7]);
    }

    [Theory]
    [InlineData("{")]
    [InlineData("[1,]")]
    [InlineData("01")]
    [InlineData("1.")]
    [InlineData("\"a\u0001\"")]
    [InlineData("{\"a\":1} x")]
    [InlineData("NaN")]
    public void RejectsInvalidJson(string text) => Assert.Throws<FormatException>(() => SpdfJson.Parse(text));

    [Fact]
    public void DecodesSurrogatePairs() => Assert.Equal("😀", SpdfJson.Parse("\"\\ud83d\\ude00\""));

    [Theory]
    [InlineData(0.0078125, "0.0078125", "0.007812")]
    [InlineData(-0.0078125, "-0.0078125", "-0.007812")]
    [InlineData(5e-7, "5e-7", "0")]
    [InlineData(2.5e-6, "0.0000025", "0.000003")]
    [InlineData(1.0000005, "1.0000005", "1.000001")]
    [InlineData(0.30000000000000004, "0.30000000000000004", "0.3")]
    [InlineData(1e21, "1e+21", "1e+21")]
    [InlineData(1e-7, "1e-7", "0")]
    [InlineData(4175.5, "4175.5", "4175.5")]
    [InlineData(-0.0, "0", "0")]
    [InlineData(100.0, "100", "100")]
    public void NumbersFollowEcmaScriptAndRoundHalfEven(double x, string es, string canonical)
    {
        Assert.Equal(es, SpdfJson.FormatNumber(x));
        Assert.Equal(canonical, SpdfJson.Canonical(x));
    }

    [Fact]
    public void CanonicalSortsKeysByUtf16AndEscapesMinimally()
    {
        var obj = new Dictionary<string, object?>
        {
            ["b"] = 1L,
            ["a"] = new List<object?> { 1.0, "x\u0001\"\\é\n<>&" },
            ["\uE000"] = 1L,
            ["😀"] = 2L,
        };
        Assert.Equal("{\"a\":[1,\"x\\u0001\\\"\\\\é\\n<>&\"],\"b\":1,\"😀\":2,\"\uE000\":1}", SpdfJson.Canonical(obj));
    }

    [Fact]
    public void ComparisonTreatsIntegersAndDoublesAlike()
    {
        Assert.True(SpdfJson.JsonEquals(SpdfJson.Parse("{\"a\":[1,2.5]}"), SpdfJson.Parse("{ \"a\" : [1.0, 2.5] }")));
        Assert.NotNull(SpdfJson.Diff(SpdfJson.Parse("{\"a\":1}"), SpdfJson.Parse("{\"a\":\"1\"}")));
    }
}
