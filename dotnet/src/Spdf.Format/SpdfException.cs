namespace Spdf;

/// <summary>An SPDF error carrying a validation code (<c>E001</c>, <c>E020</c>…).</summary>
public class SpdfException : Exception
{
    /// <summary>Creates an error with a code, a message and an optional location.</summary>
    public SpdfException(string code, string message, string? where = null, Exception? inner = null)
        : base(where is null or "" ? $"{code}: {message}" : $"{code}: {message} ({where})", inner)
    {
        Code = code;
        Detail = message;
        Where = where ?? "";
    }

    /// <summary>Validation code (see the specification, §22.2).</summary>
    public string Code { get; }

    /// <summary>The message without code and location.</summary>
    public string Detail { get; }

    /// <summary>Where the problem is (a table, a key, a row), or an empty string.</summary>
    public string Where { get; }
}
